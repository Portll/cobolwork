// SPDX-License-Identifier: AGPL-3.0-or-later
// Reads one SQL statement a line (backslash-escaped newlines) and writes ok or fail for each, as
// JSqlParser parses it: diag/db2-differential.mjs runs it.
import java.io.*;
import java.nio.charset.StandardCharsets;
import net.sf.jsqlparser.parser.CCJSqlParserUtil;

public class Diff {
  public static void main(String[] a) throws Exception {
    BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
    PrintWriter out = new PrintWriter(new OutputStreamWriter(System.out, StandardCharsets.UTF_8));
    String line;
    while ((line = in.readLine()) != null) {
      StringBuilder b = new StringBuilder();
      for (int i = 0; i < line.length(); i++) {
        char c = line.charAt(i);
        if (c == '\\' && i + 1 < line.length()) { char n = line.charAt(++i); b.append(n == 'n' ? '\n' : n == 't' ? '\t' : n); }
        else b.append(c);
      }
      String verdict;
      try { CCJSqlParserUtil.parse(b.toString(), p -> p.withTimeOut(4000)); verdict = "ok"; }
      catch (Throwable e) { verdict = "fail"; }
      out.println(verdict);
    }
    out.flush();
  }
}

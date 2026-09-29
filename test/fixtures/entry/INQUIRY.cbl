       IDENTIFICATION DIVISION.
       PROGRAM-ID. INQUIRY.
      * Started by INQ1. The account typed is built into dynamic SQL.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-INPUT.
          05 WS-ACCT          PIC X(10).
       01 WS-STMT             PIC X(200).
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-INPUT) END-EXEC
           STRING 'SELECT * FROM ACCT WHERE ID = ' WS-ACCT
              DELIMITED BY SIZE INTO WS-STMT
           EXEC SQL PREPARE S1 FROM :WS-STMT END-EXEC
           EXEC CICS RETURN END-EXEC.

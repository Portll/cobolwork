       IDENTIFICATION DIVISION.
       PROGRAM-ID. EXITPGM.
      * Run as a main program, EXIT PROGRAM carries on to the statement
      * after it.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-I FROM COMMAND-LINE
           EXIT PROGRAM.
       NEXT-PARA.
           MOVE 'X' TO WS-ENTRY(WS-I)
           STOP RUN.

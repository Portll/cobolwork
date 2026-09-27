       IDENTIFICATION DIVISION.
       PROGRAM-ID. DEADPARA.
      * Nothing performs or falls into the paragraph that uses the
      * index: the run ends before it.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-I FROM COMMAND-LINE
           STOP RUN.
       UNUSED-PARA.
           MOVE 'X' TO WS-ENTRY(WS-I).
